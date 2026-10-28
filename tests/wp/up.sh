#!/usr/bin/env bash
# Boots the test WordPress with an optional plugin dir: see harness.sh.
exec "$(dirname "$0")/harness.sh" up "$@"
