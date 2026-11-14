import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assetName, targets } from '../../packages/cli/lib/release.mjs';
import { releaseVersion } from './version.mjs';

const exec = promisify(execFile);

export async function formula({ directory }) {
  const version = await releaseVersion();
  const checksums = new Map();
  let revision;
  for (const target of Object.values(targets)) {
    const name = assetName({ version, target });
    const receipt = (await readFile(join(directory, `${name}.sha256`), 'utf8')).trim().split(/\s+/);
    if (receipt.length !== 2 || !/^[a-f0-9]{64}$/.test(receipt[0]) || receipt[1] !== name) throw new Error(`Invalid checksum receipt for ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
    if (hash.digest('hex') !== receipt[0]) throw new Error(`Checksum mismatch for ${name}`);
    const source = JSON.parse((await exec('tar', ['-xOzf', join(directory, name), 'SOURCE.json'], { maxBuffer: 65536 })).stdout);
    if (source.version !== version || source.target !== target || source.sourceKind !== 'git-commit' || !/^[a-f0-9]{40}$/.test(source.revision)) throw new Error(`Archive provenance does not describe a committed ${version}/${target} release: ${name}`);
    if (revision && source.revision !== revision) throw new Error('Release archives were built from different source revisions.');
    revision = source.revision;
    checksums.set(target, receipt[0]);
  }
  const asset = (target, indent) => `${indent}url "https://github.com/spacefast/zero/releases/download/v${version}/${assetName({ version, target })}"\n${indent}sha256 "${checksums.get(target)}"`;
  return `# Generated from verified release archives. Publish those exact archives before using this formula.
class First < Formula
  desc "Compile a typed backend and run native WordPress locally"
  homepage "https://github.com/spacefast/zero"
  version "${version}"
  license all_of: ["MIT", "GPL-2.0-or-later"]

  depends_on "node"

  on_macos do
    if Hardware::CPU.arm?
${asset(targets['darwin-arm64'], '      ')}
    else
${asset(targets['darwin-x64'], '      ')}
    end
  end

  on_linux do
    if Hardware::CPU.arm?
${asset(targets['linux-arm64'], '      ')}
    else
${asset(targets['linux-x64'], '      ')}
    end
  end

  def install
    bin.install "first"
    pkgshare.install "LICENSE", "LICENSE-MIT", "LICENSE-GPL", "Cargo.lock", "SOURCE.json", "licenses"
  end

  test do
    (testpath/"first.config.ts").write <<~TS
      import { defineConfig, table, text } from 'first';
      export const notes = table({ title: text() });
      export default defineConfig({});
    TS
    system "#{bin}/first", "check", testpath
  end
end
`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [directory, destination] = process.argv.slice(2);
  if (!directory || !destination) throw new Error('Usage: node scripts/release/homebrew.mjs <release-directory> <new-formula-path>');
  const contents = await formula({ directory: resolve(directory) });
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await writeFile(destination, contents, { flag: 'wx' });
}
