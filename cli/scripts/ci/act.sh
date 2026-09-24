#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd -P)
cd "$repo_root"
run_id="cloudreve-cli-act-$(date +%s)-$$"
export CR_CI_PARENT_RUN_ID="$run_id"
finish() {
  result=$?
  trap - EXIT
  if ! CR_CI_CLEANUP_PARENT=1 bash scripts/ci/cleanup.sh; then result=1; fi
  exit "$result"
}
trap finish EXIT
export DOCKER_HOST="${DOCKER_HOST:-$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')}"
mise exec act@0.2.89 -- act --workflows .github/workflows/check.yml \
  --artifact-server-path "$repo_root/.artifacts/act" --env "CR_CI_PARENT_RUN_ID=$run_id" "$@"
