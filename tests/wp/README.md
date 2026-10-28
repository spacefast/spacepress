# WordPress test harness

A disposable WordPress 7.1 + MariaDB 11.4 + Secure Custom Fields 6.9.7 in Docker,
for the WordPress-target tests. The database lives on tmpfs, so data never
outlives `down.sh`. The credentials in `compose.yml` and `up.sh` are throwaway
values for this local container only and are tracked intentionally.

```sh
tests/wp/up.sh path/to/built/plugin   # boot, install SCF + the plugin; last line is JSON:
                                      # {"url","user","appPassword","wordpress","scf"}
tests/wp/wp.sh plugin list            # WP-CLI inside the stack
tests/wp/down.sh                      # remove containers and volumes
```

`ZERO_WP_PORT` (default 8790) picks the host port. The SCF zip is downloaded
once into `cache/` and checked against its sha256.
