#!/usr/bin/env node
// Mechanical First -> TypedPress rename. Public modules and binaries use typedpress;
// app directories, hidden state, snake identifiers and constants use tp / TP.
// Run --dry-run first. Generated dependencies, bundles and catalogs need regeneration.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP = [
  /(^|\/)vendor(?:-prefixed)?\//,
  /^docs\/decisions\//,
  /(^|\/)CHANGELOG\.md$/,
  /^docs\/benchmarks\//,
  /^runtime\/(?:admin|identity)\/build\//,
  /^runtime\/admin\/upstream-metadata\//,
  /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|composer\.lock)$/,
  /^Cargo\.lock$/,
  /^src\/wordpress\/catalog\.json$/,
  /^tests\/differential\/url-wpt\.json$/,
  /(^|\/)verification\//,
  /^scripts\/rename-to-(?:first|typedpress)\.mjs$/,
  /^tests\/fixtures\/app-migrate\//,
  /^tests\/fixtures\/config-migrate\/legacy-zero\.ts$/,
  /^src\/config_migrate\/app\/client08\/(?:preact|zero-client\.js)/,
  /(^|\/)LICENSE(?:\.[\w-]+)?$/,
];

// English, platform APIs and upstream strings must survive even in code. In particular,
// first_name is WordPress metadata, and first()/first_mut() are collection operations.
const KEEP = [
  /\b(?:the|a|an|its|their|our|your|my|this|that|each|his|her) first\b/g,
  /:(?:first-child|first-of-type|first-letter|first-line)\b/g,
  /\bfirst-(?:class|party|person|come|served|time|of-type|child|light|run)\b/g,
  /\b(?:array_key_first|acf_first_activated_version|event_first_activated_pro)\b/g,
  /\bfirst_(?:name|mut|key_value|chunk|entry|call|require|active|address|count|day|failed|head|listed|marked|post|profile|run|save|value|start|end|line|segment|element|item|index|seen|time|pass|attempt|argument|param|parameter|byte|character|char|error|match|row|column|token|statement|decl|declaration|span|offset|node|file|path|id|key|last_note)\b/g,
  /\b(?:CHILD_FIRST|SELF_FIRST)\b/g,
  /\bFirst (?=commit callback|heading|paragraph|item|row|column|line|name|argument|parameter|step|attempt|pass|request|response|version:)/g,
  /\bfirstName\b/g,
  /\bFirst (?:note|post|dek|light)(?=[.,<"'`\\]|$)/g,
  /\bFirst (?=page contained|overdue check)/g,
  // Third-party CSS utilities and original story slugs.
  /\bfirst-light(?:\.[a-z]+)?\b/g,
  // The repository and all Zero 0.8 names are intentionally outside this rename.
  /(?:https?:\/\/github\.com\/)?spacefast\/zero(?:\.git)?\b/g,
];
const PRODUCT_CAMEL = new Set([
  'firstAdmin', 'firstAdminScreen', 'firstAdminStore', 'firstBin', 'firstBinary',
  'firstCapability', 'firstContentBlocks', 'firstEmdash', 'firstInput', 'firstLive',
  'firstLiveLoader', 'firstLiveSeed', 'firstLoader', 'firstPlugins', 'firstRow',
  'firstTestSecrets', 'firstTestSecretsOn', 'firstType', 'firstVersion', 'firstWebhook',
  'firstWrite', 'firstWriting',
]);
const COMMANDS = 'build|check|dev|styles|migrate|migrate-legacy|migrate-legacy-users|migrate-spacefast|sync|doctor|abilities|deploy|sources|compile-sources|compile-to-store|help|wp|run|jobs|identity|publish-due|find|insert|update|delete|action|seed|pull|init|import|types|login|logout|push|mcp|add|plugin|plugins|--help|--version|-h|-V|<command>|<site|<cmd>|\\.\\.\\.';

function shield(text, patterns, slots) {
  for (const pattern of patterns) text = text.replace(pattern, (match) => `\u0000${slots.push(match) - 1}\u0001`);
  return text;
}
function unshield(text, slots) {
  return text.replace(/\u0000(\d+)\u0001/g, (_, index) => slots[Number(index)]);
}

// A quoted standalone first is ambiguous (a pagination key, a test value, or the
// module/binary). Recognize product positions instead of replacing every string.
function quotedProduct(text, path) {
  return text.replace(/(\\?["'`])first\1/g, (match, quote, offset, all) => {
    const before = all.slice(Math.max(0, offset - 160), offset);
    const after = all.slice(offset + match.length, offset + match.length + 140);
    if (/\.join\(\s*$/.test(before)) return `${quote}tp${quote}`;
    if ((quote === '`' && !/^(?:src\/app\.rs|src\/sync\/front_matter\.rs)$/.test(path))
      || quote.startsWith('\\')
      || /^(?:src\/(?:cli|bundle|wp_plugins\/mod)\.rs|src\/commands\/init\.rs|packages\/cli\/|scripts\/release\/)/.test(path)
      || /\bscheme\s*(?:=|!=|==)\s*$/.test(before)
      || /^\s*=>\s*(?:self::verifyZero|\$op\[)/.test(after)) return `${quote}typedpress${quote}`;
    if (/\b(?:from|import|module|require)\s*\(?\s*$/.test(before)
      || /(?:FIRST_MODULE|TP_MODULE|ROOT|SLUG|NAME)\s*(?::[^=\n]+)?=\s*$/.test(before)
      || /(?:scheme|jsxImportSource|name)\\?["']?\s*:\s*$/.test(before)
      || /(?:module|binary|command|types|exports|imports|group|prefix)\s+(?:is\s+)?$/.test(before)
      || /\b(?:env!\(\s*|--bin\s+|command -v\s+)$/.test(before)
      || /(?:mcpServers|servers|manifest|metadata|schema|field|fields|op|in|decoded|sent|config|out|data|extra|global|source|value|meta)\s*\[\s*$/.test(before)
      || /(?:\.join|\bjoin|\.contains_key|\.get|\.insert|\.starts_with|add_command)\(\s*$/.test(before)
      || /\b(?:bin\.install|brew test)\s+$/.test(before)
      || /^\s*(?:module|binary|command|exports|has no export|types)\b/.test(after)
      || /^\s*:\s*\[(?:\s*\\?["'])?(?:\.\.\/|\.\/|types\/)/.test(after)
      || /^\s*:\s*(?:env!|\{\s*\\?["']?(?:schema|command))/.test(after)
      || /^\s*(?:=>|:)\s*(?:\$def\b|\(object\)|\[\s*\\?["'](?:collection|global|action|job|schema)\b)/.test(after)
      || /(?:\bfirst\s*::|\bcrate\s*::\s*builtins\s*::\s*check\()\s*$/.test(before)
      || /^(?:Cargo\.toml|packages\/cli\/package\.json|types\/(?:first|tp)\/package\.json)$/.test(path)
      || path === 'src/builtins.rs'
      || (path === 'src/layout.rs')
      || (/^runtime\/(?:First|TypedPress)\/Wp\/(?:Sealed|Sitemap|Uploads|Runtime)\.php$/.test(path))
      || (/^runtime\/(?:First|TypedPress)\/(?:Render\/Prebuilt|Wp\/Guests|Wp\/Jobs\/ActionSchedulerQueue)\.php$/.test(path))) {
      return `${quote}typedpress${quote}`;
    }
    return match;
  });
}

/** Rename product spellings only. Kept public for focused snippet tests. */
export function rename(text, path = '') {
  if (!/first|FIRST|First/.test(text)) return text;
  if (SKIP.some((pattern) => pattern.test(path))) return text;
  if (path === 'runtime/admin/upstream-inventory.json') {
    const inventory = JSON.parse(text);
    for (const entry of inventory.files) {
      entry.path = renamePath(entry.path);
      if (!entry.retainedSourcePath.startsWith('upstream-metadata/')) entry.retainedSourcePath = renamePath(entry.retainedSourcePath);
      if (entry.adaptation) entry.adaptation = rename(entry.adaptation);
    }
    if (inventory.adapterNotes) {
      for (const key of Object.keys(inventory.adapterNotes)) {
        if (typeof inventory.adapterNotes[key] === 'string') inventory.adapterNotes[key] = rename(inventory.adapterNotes[key]);
      }
    }
    return JSON.stringify(inventory, null, 2) + (text.endsWith('\n') ? '\n' : '');
  }
  if (/\/sources\/app\.(?:first|typedpress)\.json$/.test(path)) {
    const bundle = JSON.parse(text);
    if (bundle.files && bundle.canonical) {
      bundle.files = Object.fromEntries(Object.entries(bundle.files).map(([name, body]) => [renamePath(name), rename(body, name)]));
      bundle.canonical = Object.fromEntries(Object.entries(bundle.canonical).map(([name, target]) => [renamePath(name), renamePath(target)]));
      return JSON.stringify(bundle) + (text.endsWith('\n') ? '\n' : '');
    }
  }
  if (path === 'docs-site/lib/playground-catalog.ts') {
    text = text.replace(/(compilerRoot\s*=\s*)"first"/g, '$1"tp"')
      .replace(/(compilerModule\s*=\s*)"first"/g, '$1"typedpress"')
      .replace(/(moved\([^\n]*?,\s*)"first"/g, '$1"tp"')
      .replace(/first(?=\\2)/g, 'typedpress')
      .replaceAll('first\\/', 'tp\\/');
  }
  if (/^tests\/differential\/resolve-(?:first|typedpress)\.mjs$/.test(path)) {
    text = text.replace(/(specifier === )"first"/g, '$1"typedpress"');
  }
  text = text.replace(/(?<=["'`])first\.(?=(?:build|storage|auth|mail|webhook|services|search|git-dispatch|prune-guests)(?:[.:"'`]|$))/g, 'typedpress.');
  if (/^runtime\/(?:first|typedpress)-plugin\/src\/Receiver\.php$/.test(path)) text = text.replace(/\bfirst_failed\b/g, 'tp_failed');
  const slots = [];
  let out = shield(text, KEEP, slots);
  if (path === 'src/loader.rs') out = shield(out, [/\bfirst_export\b/g], slots);
  if (path === 'tests/system/journey.ts') out = shield(out, [/["']First["']/g], slots);
  out = out.replace(/\bfirst\/first\.php\b/g, 'typedpress/typedpress.php');
  if (/^runtime\/(?:first|typedpress)-plugin\/src\/Receiver\.php$/.test(path)) {
    out = out.replace(/(['"])first\1/g, '$1typedpress$1').replace(/first\//g, 'typedpress/');
  }
  if (/^runtime\/wp-plugin\/(?:first|typedpress)-runtime-uninstall\.php$/.test(path)) out = out.replace(/(['"])first\1/g, '$1typedpress$1');
  if (/^packages\/create-(?:first|typedpress)\/bin\//.test(path)) {
    out = out.replace(/(['"])first(?:\.cmd)?\1/g, (m) => m.includes('.cmd') ? m.replace('first.cmd', 'typedpress.cmd') : m.replace('first', 'typedpress'));
  }
  out = out.replace(/(["']wp["']\s*,\s*["'])first(?=["'])/g, '$1typedpress');
  out = out.replace(/(?<![\w-])\.first(?=[-\s"'`/.)}]|$)/gm, '.tp');
  // Internal names normalized from upstream stay scoped to TypedPress Admin.
  out = out.replace(/@spacefast\/first-cli\b/g, 'typedpress')
    .replace(/@spacefast\/create-first\b/g, 'create-typedpress')
    .replace(/(?<=\bnpm create )@spacefast\/first(?=[@\s]|$)/g, 'typedpress')
    .replace(/@spacefast\/first-bin-/g, '@typedpress/bin-')
    .replace(/@spacefast\/first-(pages|blocks)\b/g, '@typedpress/$1')
    .replace(/@first-admin(?=\/|\b)/g, '@typedpress-admin')
    .replace(/@first\//g, '@typedpress/');
  // Public module subpaths are literal renames, with no server/* restructure.
  out = out.replace(/(?<![\w./-])first(?=\/(?:app|client|content|jsx-runtime|jsx-dev-runtime)(?:["'`\\\s]|$))/g, (name, offset, all) => {
      const before = all.slice(Math.max(0, offset - 180), offset);
      const after = all.slice(offset + name.length, offset + name.length + 100);
      if (/(?:\.join|\bjoin|\bat)\([^;\n]*$/.test(before)
        || /\bAPP\s*:[^=]*=\s*["']$/.test(before)
        || (before.endsWith('`') && !/\b(?:from|module|import)\s+`$/.test(before) && /^\/(?:app|content|client)`/.test(after))) return 'tp';
      return 'typedpress';
    })
    .replace(/\bfirst:db\b/g, 'typedpress:db')
    .replace(/\bfirst::/g, 'typedpress::')
    .replace(/\bCARGO_BIN_EXE_first\b/g, 'CARGO_BIN_EXE_typedpress');
  // Runtime wires use short identifiers; branding and artifact/plugin names stay long.
  out = out.replace(/\bHTTP_(X_)?FIRST_/g, 'HTTP_$1TYPEDPRESS_')
    .replace(/\b(X|x)-First\b/g, '$1-TypedPress')
    .replace(/\b(X|x)-first\b/g, '$1-typedpress')
    .replace(/\bVITE_FIRST_/g, 'VITE_TP_')
    .replace(/(?<![A-Za-z0-9])FIRST_/g, 'TP_')
    .replace(/\bRESERVED_FIRST(?=_|\b)/g, 'RESERVED_TP')
    .replace(/\b__FIRST_/g, '__TP_')
    .replace(/(?<![A-Za-z0-9])(_{1,2})first(?=[_A-Z\/-])/g, '$1tp')
    .replace(/(?<![A-Za-z0-9])__first\b/g, '__tp')
    .replace(/(?<=\b(?:wp|field|group|edit|edit_others|edit_published|delete|delete_others|delete_published|create|publish|read|read_private|assign|manage|rest_prepare|rest_insert|rest_after_insert|save_post|edit_acme)_)first_/g, 'tp_')
    .replace(/(?<![A-Za-z0-9_])first_/g, 'tp_')
    .replace(/\bfirst[A-Z][A-Za-z0-9]*/g, (name) => PRODUCT_CAMEL.has(name) ? `tp${name.slice(5)}` : name)
    .replace(/\btoFirst\b/g, 'toTypedPress')
    .replace(/\bFirst(?=[A-Z_])/g, 'TypedPress')
    .replace(/\bFirst\b/g, 'TypedPress');
  out = out.replace(/(?<![\w-])first-(?=[a-z<${*'"`])/g, 'typedpress-')
    .replace(/\b(create|class|zz|x|single|hello|resolve|reject|base|such|nonexistent|fixture|spacefast)-first\b/g, '$1-typedpress')
    .replace(/(?<![\w-])\.first(?=[-\s"'`/.)}]|$)/gm, '.tp')
    .replace(/\bfirst(?=\.(?:config|gen|wasm|exe|mjs|rb|php|zip|json|d\.ts|hosted|source-bundle)\b)/g, 'typedpress')
    .replace(/\bwp(\s+(?:@\S+\s+)?)first\b/g, 'wp$1typedpress')
    .replace(/\bsf first\b/g, 'sf typedpress')
    .replace(/(?<=--bin[ =])first\b/g, 'typedpress')
    .replace(new RegExp(`(?<![\\w@.\\/\\\\-])first(?=\\s+(?:${COMMANDS})(?![\\w-]))`, 'g'), 'typedpress')
    .replace(/(?<=\b(?:command -v|brew test) )first\b/g, 'typedpress')
    .replace(/(?<=target\/(?:release|debug)\/)first\b/g, 'typedpress')
    .replace(/(?<=\/(?:release|debug|compiler|\.bin)\/)first\b/g, 'typedpress')
    .replace(/(?<=\bto\/)first(?=["'`\s]|$)/g, 'typedpress')
    .replace(/(?<=`)first(?=:)/g, 'typedpress')
    .replace(/(?<=\\n)first(?=:)/g, 'typedpress')
    .replace(/(?<=-C compiler )first\b/g, 'typedpress')
    .replace(/(?<=bin\/)first(?=["'`\s]|$)/g, 'typedpress')
    .replace(/(?<=LIKE ')first(?=%')/g, 'typedpress')
    .replace(/(?<=(?:wp|')(?:\\+_)?)first(?=\\+_|%)/g, 'tp');
  if (/^runtime\/(?:First|TypedPress)\/Wp\/ZeroNames\.php$/.test(path)) {
    out = out.replace(/(['"])first\1(?= \. substr\()/g, '$1tp$1');
  }
  if (path === 'src/config_migrate/app/omitted.rs') out = out.replace(/(\["app", )"first"/g, '$1"tp"');
  out = out.replace(/\bfirst:(?=db\b|pages\b|begin\b|end\b|(?:first|tp)_jobs_maintain\b)/g, 'typedpress:');
  if (/^runtime\/admin\/lib\/api\/view-config\.php$/.test(path)) out = out.replace(/(['"])first\1/g, '$1typedpress$1');
  if (/^(?:packages\/astro\/src\/index\.js|runtime\/admin\/apps\/packages\/schema\/src\/media\.tsx)$/.test(path)) {
    out = out.split('\n').map((line) => /^\s*(?:\/\/|\*|\/\*)/.test(line) ? line : line.replace(/\bfirst\b/g, 'tp')).join('\n');
  }
  out = quotedProduct(out, path);
  // Filesystem paths are separate from public module imports, handled above.
  out = out.replace(/(?<![\w.-])first\//g, 'tp/')
    .replace(/(?<=\/)first(?=["'`\s.)}]|$)/g, 'tp')
    .replace(/(?<=runtime\/)First(?=\/)/g, 'TypedPress');
  // Hidden state/app roots use short names, including literal ROOT and .join calls.
  if (path === 'src/layout.rs') out = out.replace(/(ROOT[^=]*=\s*)"typedpress"/g, '$1"tp"');
  out = out.replace(/(?<=types\/)tp(?=\/|["'`\s])/g, 'typedpress');
  return unshield(out, slots);
}

export function renamePath(path) {
  if (/^docs\/decisions\//.test(path) || /^scripts\/rename-to-/.test(path)) return path;
  if (/^runtime\/admin\/upstream-metadata\//.test(path)) return path;
  return path.split('/').map((part, i, parts) => {
    if (part === 'First') return 'TypedPress';
    if (part === 'first') return i > 0 && parts[i - 1] === 'types' ? 'typedpress' : 'tp';
    if (part === '.first') return '.tp';
    return rename(part);
  }).join('/');
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  const dry = process.argv.includes('--dry-run');
  const files = git('ls-files', '-z').split('\0').filter(Boolean);
  const skipped = (path) => SKIP.some((pattern) => pattern.test(path));
  const moves = files.map((from) => {
    // Preserve basenames/content in generated/vendor/history files. Runtime namespace
    // directory moves still carry vendor files and lockfiles along with their parent.
    let to = renamePath(from);
    if (skipped(from)) {
      if (/(^|\/)vendor(?:-prefixed)?\//.test(from)) to = from.replace(/^runtime\/First\//, 'runtime/TypedPress/');
      else if (/^docs\/(?:decisions|benchmarks)\//.test(from)
        || /^runtime\/admin\/upstream-metadata\//.test(from)
        || /^tests\/fixtures\/app-migrate\//.test(from)
        || /(^|\/)verification\//.test(from)) to = from;
      else {
        const parent = renamePath(dirname(from));
        to = (parent === '.' ? '' : parent + '/') + from.split('/').pop();
      }
    }
    return [from, to];
  }).filter(([from, to]) => from !== to);
  const targets = new Map();
  for (const [from, to] of moves) {
    if (targets.has(to) || existsSync(join(root, to))) throw new Error(`Rename collision: ${from} -> ${to}`);
    targets.set(to, from);
  }
  if (!dry) {
    for (const [from, to] of moves) {
      mkdirSync(dirname(join(root, to)), { recursive: true });
      git('mv', '-f', '--', from, to);
    }
  }
  const changed = [];
  const destinations = new Map(moves);
  for (const source of files) {
    const path = destinations.get(source) ?? source;
    if (skipped(path)) continue;
    const full = join(root, dry ? source : path);
    if (!existsSync(full) || !lstatSync(full).isFile()) continue;
    const bytes = readFileSync(full);
    if (bytes.subarray(0, 8000).includes(0)) continue;
    const before = bytes.toString('utf8');
    const after = rename(before, path);
    if (before === after) continue;
    changed.push(path);
    if (!dry) writeFileSync(full, after);
  }
  if (!dry) {
    const path = 'runtime/admin/upstream-inventory.json';
    const full = join(root, path);
    if (existsSync(full)) {
      const before = readFileSync(full, 'utf8');
      const inventory = JSON.parse(before);
      for (const entry of inventory.files) {
        const adapted = join(root, 'runtime/admin', entry.path);
        entry.adaptedSha256 = createHash('sha256').update(readFileSync(adapted)).digest('hex');
        if (entry.retainedSourcePath === entry.path) entry.normalizedSha256 = entry.adaptedSha256;
      }
      const after = JSON.stringify(inventory, null, 2) + (before.endsWith('\n') ? '\n' : '');
      if (before !== after) {
        writeFileSync(full, after);
        if (!changed.includes(path)) changed.push(path);
      }
    }
  }
  for (const [from, to] of moves) console.log(`move ${from} -> ${to}`);
  for (const path of changed) console.log(`change ${path}`);
  console.log(`${dry ? 'Would move' : 'Moved'} ${moves.length} tracked files; ${dry ? 'would change' : 'changed'} ${changed.length} text files.`);
  if (moves.length || changed.length) console.log('Regenerate PHP vendors (scripts/vendor.sh all), admin/identity bundles, WordPress catalog, example clients and lockfiles; then rerun --dry-run to check idempotence.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
