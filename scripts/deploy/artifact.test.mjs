import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const tool = fileURLToPath(new URL('./local.php', import.meta.url));
const php = process.env.TP_DEPLOY_PHP || 'php';

function run(args, env = {}) {
  const [mode, ...rest] = args;
  const binary = process.env.TP_DEPLOY_BIN;
  // `typedpress deploy <mode>`: the top-level publish/backup/restore aliases are gone (#149).
  const entry = ['deploy', mode];
  const command = binary ? [...entry, ...rest] : [tool, ...args];
  const result = spawnSync(binary || php, command, { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  return { status: result.status, receipt: JSON.parse(result.stdout), output: result.stdout };
}

test('artifact preflight binds bytes, redacts env, detects history changes and refuses unqualified publish without executing PHP', async () => {
  // The adapter intentionally refuses symlinked parents; macOS aliases its default temp directory.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'typedpress-framework-lifecycle-artifact-')));
  try {
    const artifact = join(root, 'candidate');
    const app = join(artifact, 'plugins/typedpress-app-test/tp/app');
    await mkdir(join(app, 'migrations'), { recursive: true });
    await mkdir(join(artifact, 'plugins/typedpress-runtime'), { recursive: true });
    await writeFile(join(artifact, 'typedpress-manifest.json'), JSON.stringify({ app: 'test', runtime: '0.3', plugins: { 'typedpress-runtime': '0.3.0', 'typedpress-app-test': '0.3.0' } }));
    await writeFile(join(app, 'schema.php'), `<?php file_put_contents(${JSON.stringify(join(root, 'executed'))}, 'unsafe'); return ['uploads' => ['bucket' => ['env' => 'UPLOAD_BUCKET'], 'prefix' => ['env' => 'mixedCase_secret']]];`);
    await writeFile(join(app, 'functions.php'), `<?php function secret() { return \\TypedPress\\Env::get('API_SECRET'); }`);
    await writeFile(join(app, 'migrations/0001_init.sql'), 'CREATE TABLE example (id INT);');
    await writeFile(join(artifact, 'typedpress-deployment.json'), JSON.stringify({ version: 1, snapshot: { tables: {} }, destructiveChanges: [] }));
    const baseline = join(root, 'baseline');
    await cp(artifact, baseline, { recursive: true });
    const first = run(['inspect', '--artifact', `${root}/./candidate`], { API_SECRET: 'lifecycle-secret-do-not-print', UPLOAD_BUCKET: undefined, mixedCase_secret: undefined });
    assert.equal(first.status, 0);
    assert.deepEqual(first.receipt.data.environment, [
      { name: 'API_SECRET', present: true, value: '[redacted]' },
      { name: 'UPLOAD_BUCKET', present: false, value: '[redacted]' },
      { name: 'mixedCase_secret', present: false, value: '[redacted]' },
    ]);
    assert.equal(first.output.includes('lifecycle-secret-do-not-print'), false);
    await assert.rejects(readFile(join(root, 'executed')), { code: 'ENOENT' });
    await writeFile(join(app, 'migrations/0002_change.sql'), 'ALTER TABLE example DROP COLUMN id;');
    const changed = run(['inspect', '--artifact', artifact, '--baseline', baseline]);
    assert.notEqual(changed.receipt.data.digest, first.receipt.data.digest);
    assert.equal(changed.receipt.data.migrationPreflight, 'review_required');
    assert.equal(changed.receipt.data.pendingMigrations[0].destructive, true);
    await writeFile(join(app, 'migrations/0001_init.sql'), 'CREATE TABLE replaced (id INT);');
    assert.deepEqual(run(['inspect', '--artifact', artifact, '--baseline', baseline]).receipt.data.migrationHistoryChanged, ['0001_init']);
    const refused = run(['publish', '--artifact', artifact]);
    assert.equal(refused.status, 1);
    assert.equal(refused.receipt.error.code, 'host_capability_missing');
    assert.equal(refused.receipt.error.preflight.publishReady, false);
    assert.ok(refused.receipt.error.preflight.missingCapabilities.includes('host_acknowledged_process_and_database_session_drain'));
    await symlink(join(root, 'baseline'), join(artifact, 'linked'));
    assert.equal(run(['inspect', '--artifact', artifact]).receipt.error.code, 'unsafe_file');
    const alias = join(root, 'artifact-alias');
    await symlink(artifact, alias);
    assert.equal(run(['inspect', '--artifact', alias]).receipt.error.code, 'unsafe_path');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restore validates the entire archive before reserving a fresh destination', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'typedpress-framework-lifecycle-archive-')));
  try {
    const archive = join(root, 'unsafe.zip');
    const target = join(root, 'restored');
    const cli = join(root, 'cli.phar');
    await writeFile(cli, '<?php');
    for (const kind of ['traversal', 'symlink', 'unlisted', 'digest', 'duplicate', 'metadata_limit']) {
      const fixture = spawnSync(php, ['-r', `
        $z = new ZipArchive(); $z->open($argv[1], ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $kind = $argv[2]; $name = $kind === 'traversal' ? '../escape' : 'site/file';
        $z->addFromString('backup.json', $kind === 'metadata_limit' ? str_repeat('x',16_777_217) : json_encode(['version'=>1,'adapter'=>'typedpress-offline-wordpress-v1','files'=>$kind === 'unlisted' ? [] : ['file'=>['size'=>1,'sha256'=>str_repeat('0',64)]]]));
        $z->addFromString($name, 'x');
        if ($kind === 'symlink') $z->setExternalAttributesName($name, ZipArchive::OPSYS_UNIX, 0120777 << 16);
        if ($kind === 'duplicate') $z->addFromString('site/FILE', 'x');
        $z->close();
        if ($kind === 'duplicate') file_put_contents($argv[1], str_replace('site/FILE','site/file',file_get_contents($argv[1])));
      `, archive, kind], { encoding: 'utf8' });
      assert.equal(fixture.status, 0);
      await chmod(archive, 0o600);
      const result = run(['restore', '--archive', archive, '--workspace', target, '--wp-cli', cli]);
      assert.equal(result.status, 1);
      assert.ok(['unsafe_path', 'unsafe_archive', 'invalid_archive', 'digest_mismatch'].includes(result.receipt.error.code), JSON.stringify(result.receipt));
      await assert.rejects(readFile(join(target, 'owner.json')), { code: 'ENOENT' });
      await assert.rejects(readFile(join(root, 'escape')), { code: 'ENOENT' });
    }
    await mkdir(target);
    const result = run(['restore', '--archive', archive, '--workspace', target, '--wp-cli', cli]);
    assert.equal(result.receipt.error.code, 'destination_exists');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
