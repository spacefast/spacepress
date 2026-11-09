import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { releaseVersion } from '../../../scripts/release/version.mjs';

await releaseVersion();
const sourceTypes = new URL('../../../types/first/', import.meta.url);
const packageTypes = new URL('../types/', import.meta.url);
await rm(packageTypes, { recursive: true, force: true });
await mkdir(packageTypes, { recursive: true });
for (const entry of await readdir(sourceTypes, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.d.ts')) {
    await copyFile(new URL(entry.name, sourceTypes), new URL(entry.name, packageTypes));
  }
}
await copyFile(new URL('../../../LICENSE-MIT', import.meta.url), new URL('../LICENSE', import.meta.url));
await copyFile(new URL('../../../runtime/First/Cli/commands.json', import.meta.url), new URL('../lib/commands.json', import.meta.url));
