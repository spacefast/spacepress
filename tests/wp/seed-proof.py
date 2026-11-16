"""Executable publish-seed and sync contract, using the disposable WordPress harness."""
import json
import re
from pathlib import Path
import os
import subprocess
import sys

app, cli, harness = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
site = json.loads((app / 'harness.json').read_text())
golden = json.loads((Path(__file__).parent / '../fixtures/sync-file-uid.json').read_text())
uid = next(c['uid'] for c in golden if c['collection'] == 'posts' and c['basename'] == 'hello.md')


def run(*args, success=True, env=None):
    result = subprocess.run(args, text=True, capture_output=True, env=None if env is None else {**os.environ, **env})
    assert result.returncode == (0 if success else 1), f'{args}: {result.stdout}\n{result.stderr}'
    return result.stdout


def wp(*args, success=True):
    return json.loads(run(harness, 'wp', *args, success=success))


def rows(collection):
    return wp('typedpress', 'find', collection, '{}')['data']


def seed(directory, dry=False, success=True):
    run(harness, 'compose', 'exec', '-T', 'cli', 'rm', '-rf', '/tmp/typedpress-seed')
    run(harness, 'compose', 'cp', str(directory), 'cli:/tmp/typedpress-seed')
    return wp('typedpress', 'seed', '--records=/tmp/typedpress-seed', *(['--dry-run'] if dry else []), success=success)


def counts(receipt, collection, **expected):
    assert receipt['data'][collection] == dict.fromkeys(
        ['created', 'unchanged', 'skipped_existing', 'updated', 'trashed_skipped'], 0
    ) | expected, receipt


first = app / 'compiled-1/seed'
counts(seed(first, dry=True), 'posts', created=1)
assert rows('posts') == [] and rows('locked') == [], 'dry run rolled back both collections'
created = seed(first)
counts(created, 'posts', created=1)
counts(created, 'locked', created=1)
post = rows('posts')[0]
assert post['uid'] == uid and post['title'] == 'Hello', post
assert '<!-- wp:paragraph -->' in post['body'] and re.search(r'<(?:b|strong)>seed</(?:b|strong)>', post['body']) is not None, post
locked = rows('locked')[0]
counts(seed(app / 'compiled-2/seed'), 'posts', unchanged=1)
assert rows('posts') == [post], 'republishing preserves the only record'

# Start with the original uid-less file, then let the actual sync command adopt the seeded record.
run(cli, 'sync', str(app / 'project'), '--site', site['url'], '--only', 'posts', '--no-commit', '--json',
    env={'TP_APP_PASSWORD': 'editor:' + site['users']['editor']['appPassword']})
assert rows('posts') == [post], 'typedpress sync after publish creates no duplicate or update'
assert f'uid: {uid}' in (app / 'project/content/posts/hello.md').read_text()
counts(seed(first), 'posts', unchanged=1)

# A changed editable file is reported; the current site row remains authoritative.
changed = app / 'edited-seed'
changed.mkdir()
for path in first.glob('*.json'):
    value = json.loads(path.read_text())
    value['records'][0]['body'] = 'Changed by a later publish.\n'
    (changed / path.name).write_text(json.dumps(value))
receipt = seed(changed)
counts(receipt, 'posts', skipped_existing=1)
counts(receipt, 'locked', updated=1)
assert receipt['warnings'][0]['code'] == 'tp_seed_skipped_existing'
assert 'typedpress sync' in receipt['warnings'][0]['detail']
assert rows('posts') == [post]
assert 'Changed by a later publish.' in rows('locked')[0]['body']
assert rows('locked')[0]['id'] == locked['id']
counts(seed(changed), 'locked', unchanged=1)

# Adding one file does not update/delete the first one. Removing it on publish deletes nothing.
new = json.loads((first / 'posts.json').read_text())
new['records'].append({'uid': 'zr_00000000000000000002', 'fields': {'title': 'Second', 'slug': 'second'},
                       'body': 'Second post.\n', 'path': 'content/posts/second.md'})
(changed / 'posts.json').write_text(json.dumps(new))
counts(seed(changed), 'posts', created=1, unchanged=1)
assert len(rows('posts')) == 2
(changed / 'posts.json').write_text((first / 'posts.json').read_text())
counts(seed(changed), 'posts', unchanged=1)
assert len(rows('posts')) == 2, 'seed never deletes absent files'

# Deliberate WordPress trash remains deleted on later publishes.
run(harness, 'wp', 'eval', f'if (!wp_trash_post({post["id"]})) {{ throw new RuntimeException("Could not trash seeded post"); }}')
counts(seed(first), 'posts', trashed_skipped=1)
assert [r['title'] for r in rows('posts')] == ['Second']

# A bad second row must roll the whole collection back, including the first insert.
bad = json.loads((first / 'posts.json').read_text())
bad['records'] = [
    {'uid': 'zr_00000000000000000003', 'fields': {'title': 'Rollback', 'slug': 'rollback'}, 'body': 'Body.\n'},
    {'uid': 'zr_00000000000000000004', 'fields': {'unknown': True}, 'body': 'Invalid.\n'},
]
(changed / 'posts.json').write_text(json.dumps(bad))
error = seed(changed, success=False)['error']
assert error['code'] == 'invalid_input' and error['pointer'] == '/fields/unknown', error
assert [r['title'] for r in rows('posts')] == ['Second'], 'failed collection rolled back'
print('ok: dry run, seed, republish, sync adoption, editable skip, locked update, add, no deletes, trash, rollback')
