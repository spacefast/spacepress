import { copyFile } from 'node:fs/promises';
import { releaseVersion } from '../../../scripts/release/version.mjs';
await releaseVersion();
await copyFile(new URL('../../../LICENSE-MIT', import.meta.url), new URL('../../create-zero/LICENSE', import.meta.url));
