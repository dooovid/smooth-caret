#!/bin/bash
# Zips extension/ for the Chrome Web Store as dev/store/smooth-caret-<version>.zip,
# with manifest.json at the root of the zip. Upload that file in the developer
# dashboard. The version comes from extension/manifest.json.
#
#   dev/package.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./extension/manifest.json').version")
ZIP="dev/store/smooth-caret-$VERSION.zip"
rm -f "$ZIP"

# Everything in extension/ except dotfiles (.DS_Store and friends) and anything
# test-only. -X leaves out macOS extended attributes.
(cd extension && zip -X -q -r "../$ZIP" . -x '.*' '*/.*' '*test*' '*.map')

unzip -Z1 "$ZIP" | grep -qx 'manifest.json' || { echo "manifest.json isn't at the zip's root" >&2; exit 1; }
unzip -l "$ZIP"
echo "Built $ZIP"
