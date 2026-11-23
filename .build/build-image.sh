#!/usr/bin/env bash
# Build and push one GHCR image variant for a release.
# Usage: build-image.sh <Dockerfile> <suffix> <platform> <bindir> <tag>
#   e.g. build-image.sh Dockerfile "" linux/amd64 cloudreve_linux_amd64_v1 v4.23.16
# Expects the goreleaser-built linux binary at dist/<bindir>/cloudreve and
# GHCR credentials already configured for ghcr.io (docker login).
set -euo pipefail

dockerfile="${1:?dockerfile}"
suffix="${2:?suffix (may be empty)}"
platform="${3:?platform}"
bindir="${4:?goreleaser dist dir}"
tag="${5:?release tag}"

img="ghcr.io/dvorinka/cloudreve"
cache="buildcache${suffix}-$(echo "$platform" | cut -d/ -f2)"

ctx="$(mktemp -d)"
trap 'rm -rf "$ctx"' EXIT
cp "$dockerfile" "$ctx/Dockerfile"
mkdir -p "$ctx/.build"
cp .build/aria2.supervisor.conf .build/entrypoint.sh "$ctx/.build/"
bin="$(find dist -type f -path "*/${bindir}/*" -name cloudreve | head -1)"
[ -n "$bin" ] || { echo "binary for $bindir not found under dist/" >&2; exit 1; }
cp "$bin" "$ctx/cloudreve"

docker buildx build "$ctx" \
  --platform="$platform" \
  --provenance=false --sbom=false \
  --cache-from "type=registry,ref=$img:$cache" \
  --cache-to "type=registry,ref=$img:$cache,mode=max" \
  -t "$img:${tag}${suffix}-$(echo "$platform" | cut -d/ -f2)" \
  --push
