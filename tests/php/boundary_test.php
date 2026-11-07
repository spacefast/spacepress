<?php

declare(strict_types=1);

require __DIR__ . '/harness.php';

/** Direct process/engine calls, excluding methods with the same names (PDO::exec, etc.). */
function processCalls(string $php): array
{
    $tokens = array_values(array_filter(token_get_all($php), static fn ($t) => !is_array($t)
        || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)));
    $calls = [];
    $blocked = ['exec', 'shell_exec', 'system', 'passthru', 'popen', 'proc_open', 'pcntl_exec', 'dl'];
    foreach ($tokens as $i => $token) {
        if ($token === '`') {
            $calls[] = 'backtick';
        }
        // `use function shell_exec as run;` makes `run(...)` a process call under another name.
        if (is_array($token) && $token[0] === T_USE && is_array($tokens[$i + 1] ?? null) && $tokens[$i + 1][0] === T_FUNCTION) {
            for ($j = $i + 2; isset($tokens[$j]) && $tokens[$j] !== ';'; $j++) {
                $imported = $tokens[$j];
                $alias = is_array($tokens[$j - 1]) && $tokens[$j - 1][0] === T_AS;
                if (is_array($imported) && !$alias && in_array($imported[0], [T_STRING, T_NAME_FULLY_QUALIFIED], true)
                    && in_array($name = strtolower(ltrim($imported[1], '\\')), $blocked, true)) {
                    $calls[] = 'use function ' . $name;
                }
            }
        }
        if (!is_array($token) || !in_array($token[0], [T_STRING, T_NAME_FULLY_QUALIFIED], true)
            || ($tokens[$i + 1] ?? null) !== '(') {
            continue;
        }
        $previous = $tokens[$i - 1] ?? null;
        if (is_array($previous) && in_array($previous[0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION], true)) {
            continue;
        }
        $name = strtolower(ltrim($token[1], '\\'));
        if (in_array($name, $blocked, true)) {
            $calls[] = $name;
        }
    }

    return $calls;
}

eq('process scanner ignores comments, strings, methods and declarations', processCalls(<<<'PHP'
<?php
// shell_exec('example');
$text = 'system("example")';
$db->exec('SELECT 1');
$obj?->passthru();
Thing::exec();
function passthru() {}
PHP), []);
eq('process scanner finds global calls and command interpolation', processCalls(<<<'PHP'
<?php
\shell_exec('example');
PROC_OPEN('example', [], $pipes);
$out = `example`;
PHP), ['shell_exec', 'proc_open', 'backtick', 'backtick']);
eq('process scanner finds imported and aliased process functions', processCalls(<<<'PHP'
<?php
use function shell_exec as run, \proc_open;
use function Vendor\Lib\system;
use function strlen as exec_free;
use Thing;
$fn = function () use ($x) {};
run('example');
PHP), ['use function shell_exec', 'use function proc_open']);

$root = realpath(__DIR__ . '/../../runtime');
$offline = 'Zero/Deployment/Local.php';
$files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($files as $file) {
    if (!$file->isFile() || $file->getExtension() !== 'php') {
        continue;
    }
    $relative = substr($file->getPathname(), strlen($root) + 1);
    $php = file_get_contents($file->getPathname());
    eq($relative . ' process boundary', processCalls($php), $relative === $offline ? ['proc_open'] : []);
    $engines = array_filter(token_get_all($php), static fn ($token) => is_array($token)
        && in_array($token[0], [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED], true)
        && preg_match('/^\\\\?(?:FFI|V8Js|V8\\\\Isolate|Wasmer|Wasmtime)(?:\\\\|$)/i', $token[1]));
    eq($relative . ' has no foreign engine bridge', array_values($engines), []);
}
check('unused terminal diagnostics are absent', !is_file($root . '/Zero/vendor-prefixed/wp-php-toolkit/merge/functions.php'));
finish('boundary');
