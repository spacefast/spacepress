import { copyFile } from 'node:fs/promises';
import { releaseVersion } from '../../../scripts/release/version.mjs';
await releaseVersion();
await copyFile(new URL('../../../LICENSE', import.meta.url), new URL('../../create-spacepress/LICENSE', import.meta.url));
