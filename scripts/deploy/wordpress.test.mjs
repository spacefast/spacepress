import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const php = process.env.FIRST_DEPLOY_PHP || 'php';
const tool = fileURLToPath(new URL('./local.php', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));

async function sources(root) {
  const located = spawnSync(php, ['-r', 'require $argv[1]; echo json_encode([wpCore(), wpPlugin("sqlite-database-integration", WP_SQLITE_VERSION, WP_SQLITE_SHA256)]);', join(repo, 'tests/php/wp.php')], { encoding: 'utf8', timeout: 180000 });
  assert.equal(located.status, 0, located.stderr);
  const [core, integration] = JSON.parse(located.stdout);
  let wpCli = process.env.FIRST_DEPLOY_TEST_WP_CLI;
  if (!wpCli) {
    wpCli = join(root, 'wp-cli.phar');
    const response = await fetch('https://github.com/wp-cli/wp-cli/releases/download/v2.12.0/wp-cli-2.12.0.phar', { signal: AbortSignal.timeout(120000) });
    assert.equal(response.ok, true, `WP-CLI download: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), 'ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c');
    await writeFile(wpCli, bytes);
  }
  let artifact = process.env.FIRST_DEPLOY_TEST_ARTIFACT;
  if (!artifact) {
    const project = join(root, 'project');
    await mkdir(project);
    await cp(join(repo, 'examples/blog/first.config.ts'), join(project, 'first.config.ts'), { recursive: true });
    const built = spawnSync(process.env.FIRST_BIN || resolve(repo, 'target/debug/first'), ['build', project], { encoding: 'utf8', timeout: 180000 });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    artifact = join(project, '.first/wp-content');
  }
  return { wordpress: process.env.FIRST_DEPLOY_TEST_WORDPRESS || core, sqlite: process.env.FIRST_DEPLOY_TEST_SQLITE || integration, wpCli, artifact };
}

function invoke(args, success = true, environment = {}) {
  const [mode, ...rest] = args;
  const binary = process.env.FIRST_DEPLOY_BIN;
  // Through the binary, WP-CLI on a workspace is `first wp --site <workspace> <args>`.
  const entry = mode === 'wp' ? ['wp', '--site', rest[1], ...rest.slice(3)] : ['deploy', mode, ...rest];
  const command = binary ? entry : [tool, ...args];
  const child = spawnSync(binary || php, command, { encoding: 'utf8', timeout: 180000, env: { ...process.env, ...environment } });
  assert.equal(child.error, undefined);
  assert.equal(child.stderr, '');
  const receipt = JSON.parse(child.stdout);
  if (success) assert.equal(child.status, 0, JSON.stringify(receipt));
  else assert.equal(child.status, 1, JSON.stringify(receipt));
  return receipt;
}

async function wp(workspace, ...args) {
  const receipt = invoke(['wp', '--workspace', workspace, '--', ...args]);
  return readFile(receipt.data.resultFile, 'utf8');
}

test('real offline WordPress backup restores code, native content, schema, media, private files and working identity into a fresh isolated site', async () => {
  const root = await mkdtemp(join(tmpdir(), 'first-framework-lifecycle-wordpress-'));
  await chmod(root, 0o700);
  const original = join(root, 'original');
  const restored = join(root, 'restored');
  const archive = join(root, 'backup.zip');
  try {
    const { wordpress, sqlite, wpCli, artifact } = await sources(root);
    const preflight = invoke(['inspect', '--artifact', artifact]).data;
    assert.equal(preflight.app, 'blog');
    assert.equal(preflight.compilerMetadata, 'present');
    assert.match(preflight.schemaDigest, /^[0-9a-f]{64}$/);
    const poison = join(root, 'user-config.php');
    const globalConfig = join(root, 'user-wp-cli.yml');
    await writeFile(poison, `<?php file_put_contents(${JSON.stringify(join(root, 'user-config-executed'))}, 'unsafe');`);
    await writeFile(globalConfig, `require:\n  - ${poison}\n`);
    const initialized = invoke(['init', '--workspace', original, '--wordpress', wordpress, '--sqlite', sqlite, '--wp-cli', wpCli, '--artifact', artifact], true, { WP_CLI_CONFIG_PATH: globalConfig, WP_CLI_EARLY_REQUIRE: poison });
    assert.equal(initialized.data.serving, false);
    await assert.rejects(stat(join(root, 'user-config-executed')), { code: 'ENOENT' });
    assert.equal(invoke(['wp', '--workspace', original, '--', '--path=/outside-workspace', 'option', 'get', 'blogname'], false).error.code, 'unsupported_wp_target');
    for (const command of [['server'], ['--no-color', 'server', '--host=127.0.0.1'], ['shell']]) {
      assert.equal(invoke(['wp', '--workspace', original, '--', ...command], false).error.code, 'unsupported_wp_process');
    }
    const seed = join(root, 'seed.php');
    await writeFile(seed, `<?php
      $uid = wp_create_user('lifecycle-user', 'disposable-local-password', 'lifecycle@example.invalid');
      if (is_wp_error($uid)) throw new RuntimeException('user creation failed');
      \\First\\Identity\\Plugin::$accounts->ensure($uid);
      $session = \\First\\Identity\\Plugin::$sessions->create($uid);
      $jwt = \\First\\Identity\\Keys::sign(['iss'=>\\First\\Identity\\OAuth::issuer(), 'sub'=>(string)$uid, 'iat'=>time(), 'exp'=>time()+3600]);
      $post = wp_insert_post(['post_title'=>'Lifecycle native content','post_content'=>'<!-- wp:paragraph --><p>Backup body</p><!-- /wp:paragraph -->','post_status'=>'publish','post_author'=>$uid], true);
      if (is_wp_error($post)) throw new RuntimeException('post creation failed');
      $author = \\First\\Wp\\Runtime::plugin()->db()->insert('authors', ['name'=>'Lifecycle author','email'=>'author@example.invalid'], true)[0];
      $upload = wp_upload_bits('lifecycle.txt', null, 'media bytes owned by WordPress');
      if ($upload['error']) throw new RuntimeException('upload failed');
      $attachment = wp_insert_attachment(['post_title'=>'Lifecycle upload','post_mime_type'=>'text/plain','post_status'=>'inherit'], $upload['file'], $post, true);
      if (is_wp_error($attachment)) throw new RuntimeException('attachment failed');
      $private = WP_CONTENT_DIR . '/uploads/first-private/blog/assets';
      wp_mkdir_p($private); file_put_contents($private . '/lifecycle', 'private local file bytes');
      update_option('lifecycle_identity_fixture', ['uid'=>$uid,'session'=>$session['secret'],'jwt'=>$jwt,'post'=>$post,'attachment'=>$attachment,'author'=>$author['id']]);
      update_option('lifecycle_secret_fixture', 'never-print-this-local-secret');
      echo json_encode(['post'=>$post,'user'=>$uid,'author'=>$author['id']]);
    `);
    const seeded = JSON.parse(await wp(original, 'eval-file', seed, '--use-include'));
    assert.ok(seeded.post > 0);
    const before = invoke(['status', '--workspace', original]).data;
    assert.equal(before.diagnostics.sqliteIntegrity, true);
    assert.ok(before.diagnostics.migrations.some((migration) => migration.app === 'blog' && migration.id === '0001_init'));
    const locker = spawn(php, ['-r', '$lock=fopen($argv[1],"c+"); flock($lock,LOCK_EX); echo "locked"; fflush(STDOUT); fread(STDIN,1);', join(original, 'lock')], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const [signal] = await once(locker.stdout, 'data');
      assert.equal(signal.toString(), 'locked');
      assert.equal(invoke(['backup', '--workspace', original, '--output', join(root, 'busy.zip')], false).error.code, 'workspace_busy');
    } finally {
      const closed = once(locker, 'close');
      locker.stdin.end('x');
      const [code] = await closed;
      assert.equal(code, 0);
    }
    const backup = invoke(['backup', '--workspace', original, '--output', archive]).data;
    assert.match(backup.sha256, /^[0-9a-f]{64}$/);
    assert.equal((await stat(archive)).mode & 0o777, 0o600);
    assert.equal(backup.containsSecrets, true);
    const restore = invoke(['restore', '--archive', archive, '--workspace', restored, '--wp-cli', wpCli]).data;
    assert.equal(restore.wordpressBootstrap, 'not_executed; verify trusted backup using wp');
    assert.deepEqual(restore.diagnostics, before.diagnostics);
    const verify = join(root, 'verify.php');
    await writeFile(verify, `<?php
      $f = get_option('lifecycle_identity_fixture');
      $user = wp_authenticate('lifecycle-user', 'disposable-local-password');
      $session = \\First\\Identity\\Plugin::$sessions->find($f['session']);
      $claims = \\First\\Identity\\Keys::verify($f['jwt']);
      $author = \\First\\Wp\\Runtime::plugin()->db()->findFirst('authors', ['where'=>['id'=>$f['author']]]);
      $post = get_post($f['post']);
      echo json_encode([
        'content'=>$post->post_title === 'Lifecycle native content' && str_contains($post->post_content, 'Backup body'),
        'schema'=>$author['name'] === 'Lifecycle author',
        'nativePassword'=>!is_wp_error($user) && $user->ID === $f['uid'],
        'identitySession'=>$session !== null && (int)$session['wp_user_id'] === $f['uid'],
        'identitySigningKey'=>$claims !== null && $claims['sub'] === (string)$f['uid'],
        'media'=>file_get_contents(get_attached_file($f['attachment'])) === 'media bytes owned by WordPress',
        'privateFile'=>file_get_contents(WP_CONTENT_DIR . '/uploads/first-private/blog/assets/lifecycle') === 'private local file bytes',
        'privateConfig'=>get_option('lifecycle_secret_fixture') === 'never-print-this-local-secret',
        'plugins'=>is_plugin_active('first-runtime/first-runtime.php') && is_plugin_active('first-identity/first-identity.php') && is_plugin_active('first-app-blog/first-app-blog.php'),
      ]);
    `);
    const continuity = JSON.parse(await wp(restored, 'eval-file', verify, '--use-include'));
    assert.deepEqual(continuity, { content: true, schema: true, nativePassword: true, identitySession: true, identitySigningKey: true, media: true, privateFile: true, privateConfig: true, plugins: true });
    assert.equal(JSON.stringify(invoke(['status', '--workspace', restored])).includes('never-print-this-local-secret'), false);
    assert.equal(invoke(['restore', '--archive', archive, '--workspace', restored, '--wp-cli', wpCli], false).error.code, 'destination_exists');
    assert.equal(invoke(['backup', '--workspace', original, '--output', archive], false).error.code, 'destination_exists');
    await wp(restored, 'option', 'update', 'blogname', 'Clone changed independently');
    assert.notEqual((await wp(original, 'option', 'get', 'blogname')).trim(), 'Clone changed independently');
    await wp(original, 'option', 'update', 'first_upload_namespace', '0123456789abcdef0123456789abcdef');
    assert.equal(invoke(['backup', '--workspace', original, '--output', join(root, 'provider.zip')], false).error.code, 'provider_backup_unavailable');
    await wp(original, 'option', 'delete', 'first_upload_namespace');
    const failed = invoke(['wp', '--workspace', original, '--', 'lifecycle-command-that-does-not-exist'], false);
    assert.equal(failed.error.code, 'wp_cli_failed');
    assert.equal(invoke(['backup', '--workspace', original, '--output', join(root, 'uncertain.zip')], false).error.code, 'operation_uncertain');
    assert.equal(invoke(['status', '--workspace', original]).data.recovery, 'inspect_private_logs_or_restore_prior_backup_to_fresh_workspace');
    await chmod(archive, 0o644);
    assert.equal(invoke(['restore', '--archive', archive, '--workspace', join(root, 'insecure'), '--wp-cli', wpCli], false).error.code, 'insecure_archive');
    await chmod(archive, 0o600);
    assert.deepEqual((await readdir(root)).filter((name) => name.startsWith('.first-')), []);
  } catch (error) {
    if (process.env.FIRST_DEPLOY_TEST_EVIDENCE) {
      const evidence = await mkdtemp(join(process.env.FIRST_DEPLOY_TEST_EVIDENCE, 'failure-'));
      await chmod(evidence, 0o700);
      for (const workspace of [original, restored]) {
        for (const name of await readdir(workspace).catch(() => [])) {
          if (name.startsWith('native-')) await cp(join(workspace, name), join(evidence, `${workspace === original ? 'original' : 'restored'}-${name}`));
        }
      }
      process.stderr.write(`Restricted failure logs: ${evidence}\n`);
    }
    throw error;
  } finally {
    // All commands above are synchronous; this exact root owns every site and secret in this test.
    await rm(root, { recursive: true, force: true });
  }
  await assert.rejects(stat(root), { code: 'ENOENT' });
});
