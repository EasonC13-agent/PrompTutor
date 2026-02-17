#!/bin/bash
# Build script for Chrome Web Store
set -e

cd "$(dirname "$0")/.."

rm -rf dist/
mkdir -p dist/

# Copy needed files, exclude dev/build artifacts
rsync -av \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='test' \
  --exclude='store' \
  --exclude='scripts' \
  --exclude='privacy-policy.html' \
  --exclude='.gitignore' \
  --exclude='package*.json' \
  --exclude='dist' \
  --exclude='chat-collector.zip' \
  . dist/

# Create zip
cd dist && zip -r ../chat-collector.zip . && cd ..

echo "Built: chat-collector.zip ($(du -h chat-collector.zip | cut -f1))"
