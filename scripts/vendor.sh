#!/usr/bin/env bash
# Maintainer-only dependency generation. End-user builds embed the committed result.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
php -r 'if (PHP_MAJOR_VERSION !== 8 || PHP_MINOR_VERSION !== 2) { fwrite(STDERR, "Vendor generation requires PHP 8.2.\n"); exit(1); }'
pin=17dc2baf27b9a3f52834e3db729c8365d8915a80e37a087d253cf705387aa887
strauss="${STRAUSS_PHAR:-$repo/scripts/.tools/strauss-0.31.1.phar}"
if [[ ! -f $strauss ]]; then
  mkdir -p "$(dirname "$strauss")"
  curl --fail --location --silent --show-error https://github.com/BrianHenryIE/strauss/releases/download/0.31.1/strauss.phar --output "$strauss"
fi
php -r 'exit(hash_equals($argv[1], hash_file("sha256", $argv[2])) ? 0 : 1);' "$pin" "$strauss"
roots=()
case "${1:-all}" in
  runtime) roots=(TypedPress) ;;
  identity) roots=(identity) ;;
  all) roots=(TypedPress identity) ;;
  *) echo 'usage: scripts/vendor.sh [runtime|identity|all]' >&2; exit 2 ;;
esac
for root in "${roots[@]}"; do
  directory="$repo/runtime/$root"
  [[ -f $directory/composer.json ]] || continue
  (
    cd "$directory"
    composer install --no-dev --classmap-authoritative --prefer-dist --no-interaction
    rm -rf vendor-prefixed
    php -d memory_limit=1G "$strauss" --no-interaction
    php "$repo/scripts/vendor-metadata.php" "$directory" "$([[ $root == identity ]] && echo identity || echo runtime)"
  )
done
