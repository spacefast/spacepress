#!/usr/bin/env bash
# Removes the test WordPress, its database, and volumes.
set -euo pipefail
cd "$(dirname "$0")"
docker compose --profile cli down -v --remove-orphans >/dev/null 2>&1
