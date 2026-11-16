import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = new URL('../../', import.meta.url);
export async function releaseVersion(requested) {
  const cargo = await readFile(new URL('Cargo.toml', root), 'utf8');
  const version = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Cargo.toml must declare a semantic release version.');
  for (const file of ['packages/cli/package.json', 'packages/create-typedpress/package.json']) {
    const metadata = JSON.parse(await readFile(new URL(file, root), 'utf8'));
    if (metadata.version !== version) throw new Error(`${file} version ${metadata.version} differs from Cargo.toml ${version}. Update all three before packaging.`);
  }
  if (requested && requested.replace(/^v/, '') !== version) throw new Error(`Requested release ${requested} differs from package version ${version}.`);
  return version;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  releaseVersion(process.argv[2]).then((version) => process.stdout.write(`${version}\n`), (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
