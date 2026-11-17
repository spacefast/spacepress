<?php
// Compare a before/after corpus without discarding strings or comments.
function tokens($file) {
    return array_values(array_filter(token_get_all(file_get_contents($file)), static function ($token) {
        return !is_array($token) || $token[0] !== T_WHITESPACE;
    }));
}
foreach (glob($argv[1] . '/*.php') as $before) {
    $after = $argv[2] . '/' . basename($before);
    $normalize = static function ($tokens) {
        return array_map(static function ($token) {
            return is_array($token) ? [$token[0], $token[1]] : $token;
        }, $tokens);
    };
    if ($normalize(tokens($before)) !== $normalize(tokens($after))) {
        fwrite(STDERR, basename($before) . " changed non-whitespace tokens\n");
        exit(1);
    }
}
echo "Non-whitespace tokens match.\n";
