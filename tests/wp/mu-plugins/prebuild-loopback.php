<?php
// The prebuild renders pages by loopback (TypedPress\Render\Prebuilt). The site's address is the host's
// published port, which neither container can reach: WordPress answers on the `wordpress` service.
add_filter('tp_prebuild_url', static fn (string $url): string => (string) preg_replace('#^https?://[^/]+#', 'http://wordpress', $url));
