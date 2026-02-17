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
  --exclude='backend' \
  --exclude='.DS_Store' \
  --exclude='relay-extension-background.js' \
  --exclude='README.md' \
  --exclude='.env*' \
  --exclude='.github' \
  . dist/

# Create zip
cd dist && zip -r ../promptutor.zip . && cd ..

echo "Built: promptutor.zip ($(du -h promptutor.zip | cut -f1))"
