#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ ! -f .env ]]; then
  echo 'Missing infra/.env; copy .env.example and configure service secrets on this host.' >&2
  exit 1
fi
chmod 600 .env
export COMPOSE_PROJECT_NAME=business-suite
args=(--project-name business-suite --env-file .env -f compose.yaml)
for option in "$@"; do
  case "$option" in
    --https) args+=(-f linux/compose.https.yaml);;
    --web) args+=(-f linux/compose.web.yaml);;
    --public-web) args+=(-f linux/compose.web.yaml -f linux/compose.public-web.yaml);;
    --public-sites) args+=(-f linux/compose.web.yaml -f linux/compose.public-sites.yaml);;
    *) echo 'Usage: bash linux/apply.sh [--https | --web | --public-web | --public-sites]' >&2; exit 1;;
  esac
done
docker compose "${args[@]}" config --quiet
docker compose "${args[@]}" pull --ignore-buildable
docker compose "${args[@]}" up -d --build --wait --wait-timeout 180
python3 tests/smoke.py
docker compose "${args[@]}" ps --format '{{.Service}} {{.State}}'
