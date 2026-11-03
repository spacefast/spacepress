import { seedPortfolio } from './seed.mjs';
import { startStudio } from './studio.mjs';

const studio = await startStudio();
try {
  await seedPortfolio({ api: studio.api, upload: studio.upload });
  console.log(`Portfolio: ${studio.base}\nWork: ${studio.base}/work\nAdmin: ${studio.base}/wp-admin/\nProject: ${studio.project}\nEvidence and exact cleanup receipt: ${studio.evidence}/studio.json\nClean up: node examples/emdash/portfolio/cleanup.mjs ${studio.evidence}/studio.json`);
} catch (error) {
  await studio.cleanup();
  throw error;
}
