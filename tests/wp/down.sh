#!/usr/bin/env bash
# Removes the test WordPress, its database, and volumes.
exec "$(dirname "$0")/harness.sh" down
