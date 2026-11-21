import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function compare(before: string | null, after: string | null) {
    const root = mkdtempSync(join(tmpdir(), 'tp-php-compare-'));
    try {
        const dirs = ['before', 'after'].map(name => join(root, name));
        dirs.forEach(dir => mkdirSync(dir));
        [before, after].forEach((source, i) => {
            if (source !== null) {
                const path = join(dirs[i], 'functions.php');
                writeFileSync(path, `<?php\n${source}`);
                const lint = spawnSync('php', ['-l', path], { encoding: 'utf8' });
                assert.equal(lint.status, 0, lint.stdout + lint.stderr);
            }
        });
        const result = spawnSync('php', [fileURLToPath(new URL('./compare.php', import.meta.url)), ...dirs], { encoding: 'utf8' });
        assert.ifError(result.error);
        return result.status;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test('accepts nested literal syntax changes while preserving indexing and casts', () => {
    assert.equal(compare(
        "$v = (array)$input; return [1, ['k' => 2], []][0];",
        "$v = (array) $input; return array( 1, array( 'k' => 2, ), array(), )[0];",
    ), 0);
});

test('rejects changed indexes, literals, comments, and casts', () => {
    assert.equal(compare('return [1][0];', 'return array(1)[1];'), 1);
    assert.equal(compare('return f(1);', 'return f(1,);'), 1);
    assert.equal(compare("return ['[x]'];", "return array('array(x)');"), 1);
    assert.equal(compare('/* [x] */ return [];', '/* array(x) */ return array();'), 1);
    assert.equal(compare('return (array)$x;', 'return (object)$x;'), 1);
});

test('rejects missing and empty corpora', () => {
    assert.equal(compare(null, null), 1);
    assert.equal(compare('return [];', null), 1);
    assert.equal(compare(null, 'return array();'), 1);
});
