# Shared by the migration Docker lanes. The scripts run against this worktree's harness.
stage_import() {
    "$wp/harness.sh" compose exec -T cli mkdir -p /tmp/spacepress-import
    "$wp/harness.sh" compose cp "$repo/migrate/zero/wp/." cli:/tmp/spacepress-import/
}

wp_import() {
    local command="$1"
    shift
    local request
    request=$(python3 - "$command" "$@" <<'PY'
import json
import sys

operation, *args = sys.argv[1:]
positionals = []
flags = {}
for arg in args:
    if arg.startswith("--"):
        flag, separator, value = arg[2:].partition("=")
        flags[flag] = value if separator else True
    else:
        positionals.append(arg)
print(json.dumps([operation, positionals, flags]))
PY
)
    "$wp/harness.sh" wp eval-file /tmp/spacepress-import/entry.php "$request"
}

import_tables() {
    local app="$1"
    stage_import
    "$wp/harness.sh" compose cp "$app/table-import.json" cli:/tmp/spacepress-import/tables.json
    wp_import tables /tmp/spacepress-import/tables.json --apply
}
