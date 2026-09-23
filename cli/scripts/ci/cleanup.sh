#!/usr/bin/env bash
# Docker orchestration only; never executes the application or test runtime on the host.
set -euo pipefail
if [[ "${CR_CI_CLEANUP_PARENT:-}" == 1 ]]; then
  scope_key=dev.cloudreve.ci-parent
  run_id=${CR_CI_PARENT_RUN_ID:?CR_CI_PARENT_RUN_ID is required for parent cleanup}
else
  scope_key=dev.cloudreve.ci-run
  run_id=${CR_CI_RUN_ID:?CR_CI_RUN_ID is required for job cleanup}
fi
repo_root=$(cd "$(dirname "$0")/../.." && pwd -P)
[[ "$run_id" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
result=0
owned() {
  local kind=$1 id=$2 labels
  if [[ "$kind" == container ]]; then labels='.Config.Labels'; else labels='.Labels'; fi
  [[ $(docker "$kind" inspect "$id" --format "{{index $labels \"$scope_key\"}}") == "$run_id" ]] &&
    [[ $(docker "$kind" inspect "$id" --format "{{index $labels \"dev.cloudreve.worktree\"}}") == "$repo_root" ]] &&
    [[ $(docker "$kind" inspect "$id" --format "{{index $labels \"dev.cloudreve.role\"}}") == test ]]
}
container_ids=$(docker ps -aq --filter "label=$scope_key=$run_id")
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  if owned container "$id"; then docker rm -f -v "$id" >/dev/null || result=1; else result=1; fi
done <<<"$container_ids"
network_ids=$(docker network ls -q --filter "label=$scope_key=$run_id")
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  if owned network "$id"; then
    # Within a Linux job only, disconnect this job's own container. Foreign attachments remain errors.
    if [[ -f /.dockerenv ]]; then
      runner=$(docker container inspect "$(hostname)" --format '{{.Id}}' 2>/dev/null || true)
      if [[ -n "$runner" ]] && docker network inspect "$id" --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' | grep -Fxq "$runner"; then
        docker network disconnect "$id" "$runner" || result=1
      fi
    fi
    docker network rm "$id" >/dev/null || result=1
  else result=1; fi
done <<<"$network_ids"
volume_ids=$(docker volume ls -q --filter "label=$scope_key=$run_id")
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  if owned volume "$id"; then docker volume rm "$id" >/dev/null || result=1; else result=1; fi
done <<<"$volume_ids"
exit "$result"
