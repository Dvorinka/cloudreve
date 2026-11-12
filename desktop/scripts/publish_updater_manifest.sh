#!/usr/bin/env bash
# Publish the Tauri updater manifest for a desktop release.
#
# GitHub's `releases/latest` is not a reliable desktop channel: android-v*
# tags also create releases, so the moving "latest" release can be Android-only
# and have no latest.json. Keep a dedicated prerelease that only carries the
# manifest; platform URLs inside it still point at the immutable versioned
# release assets.
set -euo pipefail

TAG="${1:?usage: publish_updater_manifest.sh <tag>}"
UPDATER_RELEASE="desktop-updater"

mkdir -p sigs
gh release download "$TAG" -p '*.sig' -D sigs --clobber
python3 desktop/scripts/gen_latest_json.py "$TAG" sigs latest.json
gh release upload "$TAG" latest.json --clobber

if ! gh release view "$UPDATER_RELEASE" >/dev/null 2>&1; then
  gh release create "$UPDATER_RELEASE" \
    --prerelease \
    --title "Cloudreve Desktop updater" \
    --notes "Rolling updater manifest for Cloudreve Desktop. Do not install directly."
fi
gh release upload "$UPDATER_RELEASE" latest.json --clobber
