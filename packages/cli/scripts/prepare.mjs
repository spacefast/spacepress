import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { releaseVersion } from '../../../scripts/release/version.mjs';

await releaseVersion();
const sourceTypes = new URL('../../../types/spacepress/', import.meta.url);
const packageTypes = new URL('../types/', import.meta.url);
await rm(packageTypes, { recursive: true, force: true });
await mkdir(packageTypes, { recursive: true });
for (const entry of await readdir(sourceTypes, { withFileTypes: true })) {
  if (entry.isFile() && /\.d\.c?ts$/.test(entry.name)) {
    await copyFile(new URL(entry.name, sourceTypes), new URL(entry.name, packageTypes));
  }
}
const sourceStubs = new URL('stubs/', sourceTypes);
const packageStubs = new URL('stubs/', packageTypes);
await mkdir(packageStubs, { recursive: true });
for (const entry of await readdir(sourceStubs, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.mjs')) {
    await copyFile(new URL(entry.name, sourceStubs), new URL(entry.name, packageStubs));
  }
}
const sourceClient = new URL('../../client/src/', import.meta.url);
const packageClient = new URL('../client/', import.meta.url);
await rm(packageClient, { recursive: true, force: true });
await mkdir(packageClient, { recursive: true });
for (const entry of await readdir(sourceClient, { withFileTypes: true })) {
  if (entry.isFile() && /\.(mjs|d\.ts)$/.test(entry.name)) {
    await copyFile(new URL(entry.name, sourceClient), new URL(entry.name, packageClient));
  }
}
await copyFile(new URL('../../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));
await copyFile(new URL('../../../runtime/SpacePress/Cli/commands.json', import.meta.url), new URL('../lib/commands.json', import.meta.url));
