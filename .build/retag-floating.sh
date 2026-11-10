#!/usr/bin/env bash
# Re-point the floating GHCR tags (latest, v4, slim) at a released tag.
# GoReleaser no longer manages them — see .goreleaser.yaml. Only the
# highest v* tag may move them, so re-releasing an old tag is harmless.
# Manual use after a local `goreleaser release`:
#   ./.build/retag-floating.sh v4.23.13
set -euo pipefail

tag="${1:?usage: retag-floating.sh <vX.Y.Z>}"
img="ghcr.io/dvorinka/cloudreve"

git fetch --tags --force --quiet 2>/dev/null || true
newest="$(git tag -l 'v[0-9]*' | sort -V | tail -n1)"

if [ "$tag" != "$newest" ]; then
  echo "retag-floating: $tag is not the newest tag ($newest); floating tags untouched"
  exit 0
fi

docker buildx imagetools create -t "$img:latest" -t "$img:v4" "$img:$tag"
docker buildx imagetools create -t "$img:slim" "$img:$tag-slim"
