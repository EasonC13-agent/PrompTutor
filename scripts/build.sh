#!/usr/bin/env bash
# Package only extension runtime assets, never repository/private files.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/
rm -f promptutor.zip
mkdir -p dist/
cp manifest.json dist/
cp -R src icons dist/
(
  cd dist
  zip -qr ../promptutor.zip manifest.json src icons
)
printf 'Built: promptutor.zip\n'
