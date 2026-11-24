import { execFileSync, spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

type Finding = { line: number; column: number; type: string; message: string; source: string };
type Report = { files: Record<string, { messages: Finding[] }> };

const base = process.argv[2];
if (!base) {
    throw new Error('Usage: node scripts/check-php-standards.ts <base-commit>');
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const diff = ['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color'];
// HEAD is the PR merge result in CI. The comparison also works on a local branch.
const files = git(
    ...diff, '--name-only', '-z', '--diff-filter=AMT', base, 'HEAD', '--',
    ':(glob)runtime/**/*.php',
    ':(glob,exclude)runtime/**/vendor-prefixed/**',
    ':(glob,exclude)runtime/**/build/**',
    ':(glob,exclude)runtime/admin/apps/**',
    ':(glob,exclude)runtime/admin/upstream-metadata/**',
).split('\0').filter(Boolean);

const changedLines = new Map<string, Array<{ start: number; end: number }>>();
for (const file of files) {
    const patch = git(...diff, '--unified=0', base, 'HEAD', '--', `:(literal)${file}`);
    const ranges = [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
        .map(([, start, count]) => ({ start: Number(start), end: Number(start) + Number(count ?? 1) }));
    if (ranges.some(({ start, end }) => start < end)) {
        changedLines.set(resolve(root, file), ranges);
    }
}

if (changedLines.size > 0) {
    const result = spawnSync(process.env.SP_PHPCS ?? 'examples/php-standards/vendor/bin/phpcs', [
        '--standard=examples/php-standards/runtime.xml',
        '--report=json',
        ...changedLines.keys(),
    ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (result.error) {
        throw result.error;
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }
    if (result.status === null || result.status > 2) {
        throw new Error(`PHPCS failed: ${result.stdout}`);
    }

    const report: Report = JSON.parse(result.stdout);
    for (const [file, { messages }] of Object.entries(report.files)) {
        const ranges = changedLines.get(file);
        for (const { line, column, type, message, source } of messages) {
            if (ranges?.some(({ start, end }) => line >= start && line < end)) {
                console.error(`${relative(root, file)}:${line}:${column}: ${type}: ${message} (${source})`);
                process.exitCode = 1;
            }
        }
    }
}
