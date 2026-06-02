#!/usr/bin/env bash
# Builds ai-fact-checker.zip (the extension bundle users download)
set -e

ZIP_NAME="ai-fact-checker.zip"

# Remove old build
rm -f "$ZIP_NAME"

# Pack only the extension files (not the worker, landing page, or build scripts)
zip -r "$ZIP_NAME" \
  manifest.json \
  background.js \
  content.js \
  content.css \
  popup.html \
  popup.js \
  icons/

echo "✓ Built $ZIP_NAME"
echo "  Upload this file alongside index.html so the download button works."
